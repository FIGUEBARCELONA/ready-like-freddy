# RLF KB y visor — Contrato de alcance operativo

## Flujo propietario de este sistema

Este sistema preserva y expone el **corpus/KB documental mundial de Ready Like Freddy**. Su objeto son las variantes individuales Fred Perry, sus nombres y códigos oficiales permitidos, el color literal de la variante exacta cuando exista evidencia, la procedencia, los hashes, los estados de normalización, las limitaciones de fábrica y el registro de auditoría. El visor es interno, documental y no comercial.

| Capacidad | Estado en este sistema | Límite |
|---|---|---|
| Libros canónicos RLF | Solo lectura mediante manifesto, versión y SHA-256 | No se escriben ni se sustituyen los originales. |
| Variantes y normalización | Permitidas únicamente cuando la evidencia oficial satisface el contrato RLF | Sin SKU mappings, inferencias ni propagaciones. |
| Evidencia visual | `NOT_INGESTED` por defecto | Ninguna descarga, copia, transformación o uso visual sin derechos acreditados. |
| Visor | Búsqueda y consulta documental con trazabilidad | Sin precio, carrito, compra, stock, logística o enlace comercial. |

## Flujos explícitamente independientes

| Flujo | Responsable externo | Límite de integración |
|---|---|---|
| Etiquetas históricas de prendas Fred Perry | Flujo independiente de recopilación y clasificación | Puede entregar un manifesto verificado en el futuro; no se ingieren etiquetas automáticamente ni se asumen identificaciones. |
| Pool de productos para venta | Flujo comercial independiente | No alimenta el KB ni recibe datos de este visor como recomendación de compra. |
| Proveedores de segunda mano con URL propia | Flujo independiente de proveedores | Este sistema no rastrea, clasifica, consulta, descarga imágenes ni almacena enlaces de compra o pagos. Los marketplaces y aplicaciones quedan fuera del alcance del visor. |

> La coincidencia de una misma prenda entre flujos no autoriza a cruzar activos, datos de compra, imágenes o inferencias. Cualquier integración futura debe pasar por un manifesto de solo lectura, con versión, hash, propósito, derechos y revisión humana cuando corresponda.

## Regla de preservación

La aplicación registra referencias a libros canónicos, importaciones verificadas y decisiones de auditoría. La preservación de los archivos fuente se mantiene fuera de la aplicación, en los registros canónicos existentes y sus copias verificadas. Ninguna operación del dashboard borra, modifica o rota una fuente canónica.
