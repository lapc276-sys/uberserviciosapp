"""The queue: no job taken twice, failures retried with growing waits."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from klaudy_pipeline.db import connect
from klaudy_pipeline.queue import claim, enqueue, fail, finish, requeue_stuck


def test_claim_takes_each_job_once(conn):
    first = enqueue(conn, "validate_recording", {"recordingId": "a"})
    second = enqueue(conn, "validate_recording", {"recordingId": "b"})
    a = claim(conn, "w1")
    b = claim(conn, "w2")
    assert {a.id, b.id} == {first, second}
    assert claim(conn, "w3") is None
    finish(conn, a)
    status = conn.execute('SELECT status FROM "ProcessingJob" WHERE id = %s', [a.id]).fetchone()["status"]
    assert status == "done"


def test_concurrent_workers_never_share_a_job(conn, database_url):
    ids = {enqueue(conn, "extract_frames", {"recordingId": str(i)}) for i in range(24)}

    def work(name):
        own = connect(database_url)
        taken = []
        while (job := claim(own, name)) is not None:
            taken.append(job.id)
        own.close()
        return taken

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(work, ["w1", "w2", "w3", "w4"]))
    taken = [job for result in results for job in result]
    assert len(taken) == len(set(taken)) == 24
    assert set(taken) == ids


def test_a_failure_waits_longer_each_time_then_gives_up(conn):
    enqueue(conn, "summarize_sensors", {"recordingId": "x"})
    job = claim(conn, "w")
    assert fail(conn, job, "boom") == "queued"
    assert claim(conn, "w") is None, "not due again yet"
    wait = conn.execute('SELECT "runAfter" - now() AS wait FROM "ProcessingJob" WHERE id = %s', [job.id]).fetchone()["wait"]
    assert timedelta(seconds=50) < wait <= timedelta(minutes=1)

    conn.execute('UPDATE "ProcessingJob" SET attempts = "maxAttempts" - 1, "runAfter" = now() WHERE id = %s', [job.id])
    job = claim(conn, "w")
    assert fail(conn, job, "boom again") == "failed"
    row = conn.execute('SELECT status, error FROM "ProcessingJob" WHERE id = %s', [job.id]).fetchone()
    assert row == {"status": "failed", "error": "boom again"}


def test_a_dead_workers_job_goes_back_to_the_queue(conn):
    enqueue(conn, "validate_recording", {"recordingId": "y"})
    job = claim(conn, "dead")
    conn.execute('UPDATE "ProcessingJob" SET "lockedAt" = now() - interval \'2 hours\' WHERE id = %s', [job.id])
    assert requeue_stuck(conn) == 1
    assert claim(conn, "alive").id == job.id
