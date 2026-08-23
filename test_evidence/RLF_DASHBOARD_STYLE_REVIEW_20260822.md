# Revisión de estilo — RLF Workstream Control

| Fuente revisada | Decisión aplicada | Evidencia de interfaz |
|---|---|---|
| Tema RLF local `style.css` | Traslado de contraste oscuro, jerarquía editorial y acento cálido sin copiar activos. | Cabeceras negras con títulos serif y acento dorado en `/`, `/imports`, `/calibration` y `/visual`. |
| `client/src/index.css` | Tokens de fondo claro, texto de alto contraste y superficies de lectura. | Paneles blancos cálidos y fondos piedra visibles en las capturas de rutas autenticadas. |
| `DashboardLayout.tsx` | Navegación lateral persistente, ruta activa y densidad operativa contenida. | Barra lateral consistente visible en las capturas de las ocho rutas autenticadas. |
| Política de activos RLF | Cero imágenes de producto sin derechos y ningún logo o visual externo incorporado. | Vista `/visual` declara cero assets y no renderiza recursos de prendas. |

Las decisiones de estilo no alteran el significado de los estados: los colores de validación, cuarentena y bloqueo se conservan como señales semánticas y accesibles.
