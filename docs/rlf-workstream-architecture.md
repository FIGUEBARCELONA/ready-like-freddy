# Arquitectura funcional — RLF Workstream Control

## Propósito

RLF Workstream Control es un panel interno autenticado para **coordinar y auditar** hasta cincuenta workstreams identificables (`F01`–`F50`). La aplicación administra estados, tareas atómicas, dependencias, incidencias, eventos, reasignaciones, caché de verificaciones e importaciones canónicas. No ejecuta cambios remotos, no ingiere activos visuales ni escribe nunca en las fuentes canónicas RLF.

## Principios de seguridad

| Principio | Implementación |
|---|---|
| Fail-closed | Las transiciones inválidas, dependencias incompletas, hashes ausentes y manifestos no verificables quedan bloqueados. |
| Solo lectura canónica | Las fuentes RLF se representan por manifestos con ruta, checksum, versión y metadatos; el producto solo registra la importación verificada. |
| Trazabilidad | Toda mutación operativa crea un evento de auditoría con actor, estado previo, estado posterior, razón y fecha UTC. |
| Visuales protegidos | El esquema no contiene binarios visuales ni admite estados distintos de `NOT_INGESTED` sin una futura ampliación aprobada. |
| Normalización limitada | La aplicación prohíbe mappings `SKU`; cualquier caché normalizada exige `MODEL_NAME`, `PRODUCT_CODE`, `COLOUR_NAME` o `COLOUR_CODE` y procedencia verificable. |
| Realidad verificable | La API rechaza marcadores de contenido de ejemplo, placeholder, fake, simulación, dato de prueba o fabricación antes de persistir particiones, tareas, incidencias, caché, manifestos o calibraciones. |

## Modelo de operación

| Dominio | Entidad persistente | Responsabilidad |
|---|---|---|
| Workstreams | `workstreams` | Identificadores F01–F50, carga, estado factual, dependencia y responsable. |
| Partición | `researchPartitions`, `researchScopeClaims` | Reservas exclusivas de ámbito y claims canónicos que impiden duplicar fuentes, códigos, modelos o afirmaciones. |
| Cola | `workItems`, `workItemDependencies` | Tareas atómicas; solo pasan a ejecución cuando todas las dependencias están superadas. |
| Auditoría | `auditEvents`, `reassignments`, `incidents` | Registro append-only de operaciones factuales, errores e incidencias. |
| Memoria | `verificationCache` | Evidencia con URL, locale, SHA-256, sello UTC, invalidez controlada y origen. |
| Canonical books | `canonicalImports`, `canonicalImportEntries` | Manifestos de solo lectura con versión, checksum y resultado de verificación. |
| Calibración | `calibrationRuns`, `calibrationMetrics` | Cargas explícitas de métricas verificadas, sin generar datos sintéticos. |

## Límites de la primera versión

La cola es **operativa y persistente**, pero no despacha bots, procesos externos ni cambios de infraestructura. Sus estados describen la gestión humana o de futuros ejecutores autorizados. La actualización “en tiempo real” se implementa como refresco controlado del panel contra la base de datos; no se simulan cincuenta procesos en ejecución.

Los slots F01–F50 son capacidad operativa declarada, no registros de investigación ficticios. Permanecen sin inicializar y no muestran fuentes, variantes, métricas ni actividad hasta que una operación autenticada y auditada los cree y reserve un alcance real.

## Partición verificable de investigación

Cada workstream puede reservar exactamente una partición activa mediante una `partitionKey` y una huella SHA-256 de alcance. Antes de ser activado, declara claims exclusivos con tipo y huella propia: URL oficial, código de producto, modelo, color, afirmación de fábrica o slug de artículo. La base de datos impone unicidad tanto en la partición como en cada claim. Por ello, una reserva que reutilice una fuente, variante, denominación o afirmación ya reclamada queda rechazada antes de entrar en la cola. La reasignación transfiere una tarea entre workstreams, pero no duplica ni libera sus claims salvo retirada auditada de la partición original.

## Estados permitidos

| Recurso | Estados |
|---|---|
| Workstream | `NOT_STARTED`, `READY`, `ACTIVE`, `BLOCKED`, `PAUSED`, `COMPLETE`, `FAILED` |
| Tarea | `QUEUED`, `WAITING_DEPENDENCY`, `READY`, `IN_PROGRESS`, `BLOCKED`, `COMPLETE`, `FAILED`, `CANCELLED` |
| Incidencia | `OPEN`, `INVESTIGATING`, `RESOLVED`, `ESCALATED` |
| Importación | `PENDING`, `VERIFIED`, `REJECTED` |
| Caché | `VALID`, `INVALIDATED`, `SUPERSEDED` |

## Controles de autorización

Las lecturas del panel requieren autenticación. Las mutaciones operativas requieren rol `admin`. Las operaciones de importación y calibración verifican manifestos y métricas antes de persistir sus registros. Ningún procedimiento expone escritura en archivos canónicos, llamados remotos o funciones de ingestión visual.
