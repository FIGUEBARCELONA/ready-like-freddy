# Verificación visual — Visor forense RLF

**Fecha:** 2026-08-22  
**Rutas verificadas:** `/visual`  
**Entornos:** escritorio 1280×900 y móvil 390×844.

| Comprobación | Resultado observado |
|---|---|
| Estado de datos | El visor muestra `0` piezas, `0` assets acreditados, `0` manifiestos validados y `0` decisiones `VERIFIED`; no se representan registros ficticios. |
| Límite fail-closed | El aviso visible declara que no se ingresan assets sin derechos, hash o custodia. |
| Paquete canónico | Se comunican cuatro vistas estándar, cinco macros base, una macro condicional y el requisito de hash/derechos. |
| Decisión forense | Se distingue explícitamente entre soporte/contradicción de proveedor y revisión del manifiesto completo con revisión humana física. |
| Adaptación móvil | Las métricas y bloques de protocolo se apilan sin recorte horizontal observable; las etiquetas siguen legibles. |

No se ha utilizado ni descargado ninguna imagen de producto durante esta verificación.
