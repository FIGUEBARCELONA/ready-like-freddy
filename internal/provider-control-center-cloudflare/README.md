# RLF Provider Control Center — Cloudflare runtime

Aplicació interna real per a la Fase 1 del cens UE-27. No simula workers ni promociona proveïdors automàticament.

## Arquitectura

- Cloudflare Worker: API i dashboard.
- Cloudflare D1: proveïdors, cua, evidències, decisions, revisions, deduplicació, checkpoints i activitat.
- Cloudflare Queues: verificació HTTP concurrent amb `max_concurrency: 50`.
- Cron Trigger: recarrega fins a 50 tasques cada cinc minuts quan el motor està `running`.
- Cloudflare Access o secret `ADMIN_TOKEN`: accés privat.
- Política `APPEND_ONLY_FAIL_CLOSED`: els workers només recullen evidència; la promoció exigeix revisió humana.

## Estat canònic validat localment

El generador del paquet complet ha importat i comprovat sobre SQLite/D1 compatible:

- 10.090 identitats úniques.
- 47 `verified`.
- 28 `blocked`.
- 10.015 `not_verified`.
- 500 entrades de cua, 474 pendents i 26 ja resoltes.
- 10.198 decisions.
- 858 evidències.
- 174 controls de deduplicació.
- 50 carrils.
- 0 referències òrfenes.

## Desplegament

El workflow crea o reutilitza D1 i les cues, aplica la migració i desplega el Worker quan existeixen els secrets de repositori:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Després cal protegir el Worker amb Cloudflare Access i permetre només el correu de l'usuari. El seed canònic complet es conserva al paquet autocontingut lliurat fora del repositori i s'importa amb `wrangler d1 execute` en 25 fragments SQL hashats.

## Verificació

```bash
npm install
npm test
npm run check
```

El sistema arrenca pausat. **Activa motor** canvia l'estat a `running`; el cron o **Envia 50 tasques** publica missatges reals a Cloudflare Queues. El dashboard només mostra dades persistides a D1.
