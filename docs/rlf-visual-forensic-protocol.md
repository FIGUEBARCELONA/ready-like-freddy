# RLF-VISUAL-FORENSIC/1.0 — Paquete visual por pieza única

## Finalidad y límite probatorio

El paquete visual vincula evidencia fotográfica acreditada con **una sola pieza física** y, cuando exista prueba suficiente, con una variante documental concreta. Sirve para ayudar a identificar rasgos, detectar contradicciones y documentar conservación. No convierte por sí mismo una hipótesis en autenticación certificada, ni permite atribuir una fábrica, fecha, modelo, talla, material o color que no queden evidenciados.

> Ausencia de una captura, de derechos, de custodia, de hash, de escala o de una relación inequívoca con la pieza implica `INCOMPLETE` y bloquea cualquier decisión que dependa de ese elemento.

## Las cuatro vistas estándar

Las cuatro vistas se aplican a cualquier pieza única, con geometría adaptada únicamente cuando el objeto no tenga orientación de prenda. No pueden reutilizarse entre piezas, variantes, colorways ni estados de conservación.

| Rol | Código | Encuadre y requisito | Finalidad documental | No acredita por sí sola |
|---|---|---|---|---|
| Cara primaria completa | `STD_PRIMARY` | Pieza completa, plana y sin ocultaciones; orientación frontal o vista principal declarada | Silueta, proporción y construcción general | Autenticidad, fecha, fábrica o composición |
| Cara inversa completa | `STD_REVERSE` | Pieza completa por reverso; misma escala y distancia aproximada | Paneles, costuras, espalda y etiquetas de ubicación | Modelo o año exactos |
| Perfil lateral A | `STD_PROFILE_A` | Vista lateral izquierda o lado A declarado de forma inmutable | Volumen, caída, cierres, puños o geometría lateral | Talla, material o color literal |
| Perfil lateral B | `STD_PROFILE_B` | Vista lateral derecha o lado B declarado de forma inmutable | Simetría, construcción opuesta y elementos laterals | Estado global de conservación |

## Las cinco macros canónicas y una sexta condicional

Las macros no son decorativas. Cada una documenta un grupo de rasgos discriminants diferente y no puede suplir una macro absent. `MACRO_CONDITION` es obligatòria només quan existeix un dany, alteració, reparació o zona de desgast rellevant; si no n’hi ha, s’enregistra `NOT_APPLICABLE` amb motivació humana.

| Rol | Código | Detalle que debe cubrir | Preguntas que puede apoyar | Condición mínima |
|---|---|---|---|---|
| Marca principal | `MACRO_BRAND` | Etiqueta principal, marca, corona de laurel, tipografía o placa de marca | Coherencia de marca y construcción del marcaje | Nitidez legible y sin recortes de identificación |
| Etiqueta reglamentaria | `MACRO_REGULATORY` | Talla, composición, cuidado, origen y símbolos, si existen | Talla declarada, material declarado, origen declarado | Texto completo, plano y a foco; no inferir fecha/fábrica |
| Código o identificación | `MACRO_IDENTIFIER` | Product code, RN/CA, lote, etiqueta secundaria o identificador observable | Posible enlace a registro oficial exacto | Literal legible; un código no se convierte en SKU mapping |
| Construcción distintiva | `MACRO_CONSTRUCTION` | Piqué/tricot, costura, botón, cremallera, ribete, bordado o ferrage relevante | Coherencia material y técnica con una hipótesis | Escala visible y localización declarada |
| Elemento distintivo | `MACRO_SIGNATURE` | Detalle de diseño que diferencia familia, subfamilia o colaboración | Apoyo para diferenciar modelos compatibles | Debe describir el detalle, no atribuirlo de manera automática |
| Condición o alteración | `MACRO_CONDITION` | Desgaste, mancha, agujero, reparación, decoloración o intervención | Estado de conservación y bloqueo de condición superior | Obligatoria si existe el defecto; sin ocultar la zona |

## Reglas de captura, derechos y custodia

| Control | Regla fail-closed |
|---|---|
| Derechos | Cada archivo necesita origen, titular o cesión, alcance de uso y estado de autorización. `UNKNOWN` bloquea ingreso. |
| Custodia | El manifiesto registra quién capturó o entregó el archivo, cuándo, origen de la pieza y cadena de transferencia. |
| Integridad | Cada archivo tiene SHA-256 propio, tamaño, MIME, orientación y fecha de recepción. Un hash repetido en dos piezas bloquea ambas para revisión. |
| Escala | Las cuatro vistas y las macros de construcción o condición declaran método de escala o quedan `SCALE_NOT_DOCUMENTED`. Nunca se deducen milímetros desde una foto sin referencia. |
| Edición | No se aceptan recortes semánticos, eliminación de fondo, corrección de color, reencuadres de contenido o retoques salvo transformación documentada, reversible y autorizada. |
| Variante | La relación pieza–variante es `INCONCLUSIVE` hasta que los identificadores y la evidencia admitida converjan. Nunca se hereda desde una colorway cercana. |

## Detalles discriminantes y estados de decisión

El visor transforma cada observación en un dato delimitado: qué se ve, en qué asset, dónde, con qué calidad y qué hipótesis apoya o contradice. Los campos de autenticidad, modelo, año, fábrica, color, talla, material y conservación se evalúan separadamente.

| Estado | Definición operativa | Efecto en visor |
|---|---|---|
| `VERIFIED` | Evidencia admisible, suficiente, coherente y trazable para el campo concreto | Se muestra como verificado con evidencias enlazadas |
| `SUPPORTED` | Indicios concordantes pero falta una prueba exigida o existe alcance parcial | Se muestra como hipótesis respaldada, no certificación |
| `INCONCLUSIVE` | Insuficiencia, ambigüedad, falta de macro o limitación de derechos/custodia | Bloquea conclusión y solicita evidencia faltante |
| `CONTRADICTED` | Un detalle observable contradice la hipótesis o fuente delimitada | Bloquea la hipótesis y abre incidencia |

La autenticidad final exige paquete completo, cadena de custodia y revisión humana de la pieza física. Las fotos y textos de proveedor solo pueden alimentar `SUPPORTED`, `INCONCLUSIVE` o `CONTRADICTED` salvo que su procedencia, derechos y alcance satisfagan expresamente todos los requisitos de `VERIFIED`.
