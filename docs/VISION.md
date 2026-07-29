# Documento de Visión — Cleaners App (UberServicios)

**Versión:** 0.1 (borrador inicial)
**Fecha:** 2026-07-06
**Estado:** En elaboración

---

## 1. Resumen ejecutivo

**Cleaners App** es una plataforma tipo marketplace que conecta a personas y
empresas que necesitan servicios de limpieza con profesionales de limpieza
verificados, bajo demanda o con agendamiento programado — el modelo "Uber"
aplicado a servicios de limpieza.

La app resuelve dos problemas simétricos:

- **Para el cliente:** encontrar un servicio de limpieza confiable, con precio
  transparente, disponibilidad inmediata o programada, y garantía de calidad.
- **Para el profesional (cleaner):** acceso a un flujo constante de trabajos,
  pagos seguros y puntuales, y la posibilidad de construir reputación
  profesional sin depender de intermediarios informales.

## 2. El problema

1. El mercado de limpieza doméstica y comercial es mayormente informal:
   contrataciones por recomendación boca a boca, sin garantías ni verificación.
2. Los precios son opacos y se negocian caso por caso.
3. Los profesionales no tienen herramientas para gestionar agenda, cobros ni
   reputación.
4. No existe un canal confiable para resolver disputas (daños, inasistencias,
   cobros indebidos).

## 3. Propuesta de valor

| Para el cliente | Para el cleaner |
|---|---|
| Reserva en minutos, bajo demanda o programada | Trabajos constantes sin buscar clientes |
| Profesionales verificados (identidad y antecedentes) | Pagos garantizados por la plataforma |
| Precio transparente calculado antes de confirmar | Tarifas claras y propinas digitales |
| Calificaciones y reseñas reales | Reputación portable (perfil con historial) |
| Soporte y resolución de disputas | Flexibilidad total de horarios y zonas |

## 4. Usuarios y roles

- **Cliente:** persona u empresa que solicita el servicio. Publica la
  solicitud, paga y califica.
- **Cleaner (profesional):** ofrece servicios, define su disponibilidad y
  zonas de cobertura, acepta trabajos y cobra a través de la app.
- **Administrador de plataforma:** verifica profesionales, gestiona disputas,
  monitorea métricas y configura tarifas/comisiones.

## 5. Alcance del MVP

### Incluido (fase 1)

1. **Registro y perfiles**
   - Registro de clientes (email/teléfono + redes sociales).
   - Onboarding de cleaners con verificación de identidad y documentos.
2. **Solicitud de servicio**
   - Tipos de servicio: limpieza estándar, limpieza profunda, post-obra.
   - Selección de fecha/hora (inmediato o programado), dirección y tamaño del
     inmueble (habitaciones/baños o m²).
   - Cálculo automático de precio estimado antes de confirmar.
3. **Matching**
   - Asignación por cercanía, disponibilidad y calificación.
   - El cleaner acepta o rechaza; reintento automático con el siguiente.
4. **Seguimiento del servicio**
   - Estados: solicitado → aceptado → en camino → en progreso → completado.
   - Ubicación del cleaner en camino (mapa).
5. **Pagos**
   - Pago con tarjeta dentro de la app (pasarela de pagos).
   - Retención hasta completar el servicio; liberación al cleaner menos
     comisión de la plataforma.
   - Propinas opcionales.
6. **Calificaciones**
   - Calificación bidireccional (cliente ↔ cleaner) con comentario.
7. **Panel administrativo básico**
   - Aprobación de cleaners, listado de servicios, gestión de disputas.

### Excluido del MVP (fases posteriores)

- Servicios recurrentes con suscripción (semanal/quincenal).
- Equipos de limpieza (varios cleaners por trabajo) para clientes comerciales.
- Otros verticales de servicios (plomería, electricidad, jardinería) bajo la
  marca UberServicios.
- Programa de fidelización y referidos.
- Chat en tiempo real dentro de la app (MVP: llamada/notificaciones).

## 6. Modelo de negocio

- **Comisión por transacción:** 15–25 % sobre el valor del servicio (a
  calibrar por mercado).
- **Tarifa dinámica:** posible ajuste por alta demanda (fase posterior).
- **Suscripción de clientes comerciales:** planes mensuales para oficinas y
  locales (fase posterior).

## 7. Métricas clave (KPIs)

- Servicios completados por semana.
- Tasa de aceptación de solicitudes (< 2 reintentos ideal).
- Tiempo medio de matching.
- Calificación promedio (objetivo ≥ 4.6/5).
- Retención de clientes a 30/90 días.
- Retención de cleaners activos por mes.
- GMV y take rate efectivo.

## 8. Arquitectura propuesta (alto nivel)

- **Apps móviles:** una sola app con modo cliente/cleaner, o dos apps
  separadas (decisión pendiente). Framework sugerido: **Flutter** o
  **React Native** para iOS + Android con un solo código base.
- **Backend:** API REST/GraphQL (Node.js + NestJS o similar), con módulos de
  usuarios, servicios, matching, pagos y notificaciones.
- **Base de datos:** PostgreSQL (transaccional) + Redis (matching y estados en
  tiempo real).
- **Tiempo real:** WebSockets para tracking y estados del servicio.
- **Pagos:** pasarela según país de lanzamiento (Stripe, Mercado Pago, etc.).
- **Mapas y geolocalización:** Google Maps Platform o Mapbox.
- **Notificaciones push:** Firebase Cloud Messaging.
- **Infraestructura:** contenedores en un proveedor cloud administrado.

## 9. Roadmap tentativo

| Fase | Alcance | Duración estimada |
|---|---|---|
| 0 — Descubrimiento | Validación de mercado, wireframes, definición de tarifas | 2–3 semanas |
| 1 — MVP | Alcance descrito en §5, lanzamiento en una ciudad piloto | 10–14 semanas |
| 2 — Consolidación | Recurrencia/suscripciones, chat in-app, referidos | 8–10 semanas |
| 3 — Expansión | Nuevas ciudades, clientes comerciales, nuevos verticales | continuo |

## 10. Riesgos principales

1. **Oferta insuficiente de cleaners al inicio** → estrategia de reclutamiento
   y bonos de lanzamiento antes de abrir a clientes.
2. **Confianza y seguridad** → verificación estricta, seguro contra daños,
   soporte visible.
3. **Desintermediación** (cliente y cleaner acuerdan por fuera) → beneficios de
   permanencia, penalidades contractuales suaves, valor agregado real
   (pagos, seguro, reputación).
4. **Regulación laboral** de trabajadores de plataforma según el país.

## 11. Decisiones pendientes

- [ ] País/ciudad de lanzamiento piloto.
- [ ] Una app con dos modos vs. dos apps separadas.
- [ ] Framework móvil definitivo (Flutter vs. React Native).
- [ ] Pasarela de pagos según mercado.
- [ ] Esquema de precios: por hora vs. por tamaño del inmueble vs. híbrido.
- [ ] Nombre comercial definitivo y branding.

---

> ⚠️ **Documento obsoleto.** Escrito bajo el supuesto equivocado de que
> "visión" se refería a visión de producto y no a visión artificial. El
> proyecto real es Homigo — ver [HANDOFF.md](HANDOFF.md). Se conserva solo
> como referencia histórica.
