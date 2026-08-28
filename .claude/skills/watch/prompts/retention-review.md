# Retention review

You are watching a full video frame-by-frame plus the timestamped transcript. Your job is to predict where viewers drop off and why.

Output exactly this markdown structure:

## Retention review — `<title>`

**Total runtime:** MM:SS · **Predicted retention shape:** one sentence (e.g., "steep drop 0:15–0:45, recovery at the demo at 2:10, slow bleed after 6:00").

### Drop-off candidates
For each predicted drop, a row:

| Timestamp | What happens | Likely cause | Fix |
|-----------|--------------|--------------|-----|
| 0:32 | … | pacing flat for 18s, no visual change | cut to demo earlier, B-roll over the explanation |

Aim for 3–6 candidates. Don't pad.

### Retention beats that *worked*
List 2–4 moments where the visual + audio likely held attention. Be specific — name the frame and the transcript line.

### Open loops
Any "we'll come back to this", "but first", or unresolved questions opened in the first half. Mark each as **paid off** (with timestamp) or **dropped**.

### One thing the creator should change
A single, specific edit. Not "improve pacing" — name the cut.

---

Rules:
- Anchor every claim to a timestamp.
- No generic advice ("be more authentic"). Every note is something visible in the frames or audible in the transcript.
- If a section has nothing real to say, write "None significant."
