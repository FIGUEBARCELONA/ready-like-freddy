# Ready Like Freddy

Repositori tècnic de suport per a la construcció verificable de READY LIKE FREDDY.

Aquest repositori no conté dades de producció ni secrets. Els artefactes temporals de CI s'utilitzen exclusivament per preparar dependències públiques i verificables del projecte.

## Runtime local WordPress/WooCommerce

El workflow `Build verified WordPress WooCommerce runtime bundle` construeix i comprova un paquet local autocontingut amb WordPress 7.0.2, WooCommerce 10.9.4 i MariaDB 11.4.12. El paquet inclou imatges OCI, dump de base de dades, plugin oficial verificat, manifests SHA-256, evidències i scripts d'arrencada offline.

Aquest repositori és auxiliar: cap gate del checklist canònic de RLF no es considera tancat fins que l'artefacte s'integra i es valida dins del ZIP total vigent del projecte.
