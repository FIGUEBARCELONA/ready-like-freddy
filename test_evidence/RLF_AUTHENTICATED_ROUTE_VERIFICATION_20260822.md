# Verificación de rutas autenticadas — RLF Workstream Control

**Fecha:** 2026-08-22  
**Viewport:** 1280×900  
**Rutas comprobadas:** `/`, `/queue`, `/partitions`, `/cache`, `/imports`, `/calibration`, `/audit`, `/visual`.

| Ruta | Resultado de captura | Estado QA |
|---|---|---|
| `/` | Control central, métricas reales `0/50` y slots sin inicializar visibles. | `PASS` |
| `/imports` | Manifiestos de solo lectura y contrato de importación visibles; cero manifestos registrados. | `PASS` |
| `/audit` | Bitácora append-only vacía de forma factual visible. | `PASS` |
| `/queue` | Cola vacía factual, formulario sin valores precargados y sin workstreams reservados visibles. | `PASS` |
| `/partitions` | Reserva de ámbito vacía; campos de claims, clave y descripción no contienen datos de ejemplo. | `PASS` |
| `/cache` | Caché vacía y límite visible de mappings permitidos; SKU prohibido. | `PASS` |
| `/calibration` | Cero manifestos y métricas, sin valores precargados; formulario bloqueado por falta de manifiesto verificado. | `PASS` |
| `/visual` | Visor muestra cero piezas y cero assets acreditados; ningún asset en cuarentena se presenta como acreditado. | `PASS` |

El reintento de las rutas inicialmente en carga se realizó tras estabilizar sus consultas y todas alcanzaron estado renderizado. No se realizaron mutaciones, inicializaciones de workstreams, registros canónicos ni ingresos visuales durante esta prueba.
