# Despliegue y operación

TabUp conserva datos duraderos en SQLite y fotos de recibos en disco. Debe ejecutarse como **una sola instancia** detrás de un proxy HTTPS: SQLite, el freno de credenciales y el estado de sesión son locales al proceso.

## Docker Compose

1. Copia `.env.example` a `.env`. Sin nada más, la aplicación funciona con sus propias cuentas; con las cuatro variables OIDC fijadas, entrar es cosa del proveedor (cualquier OIDC estándar: Authentik, Keycloak, Zitadel, Auth0…).
2. Ejecuta `docker compose up -d --build`.
3. Publica únicamente el proxy TLS; Compose enlaza la aplicación a `127.0.0.1:3457`.

El contenedor corre como UID 10001, sin capacidades, con raíz de solo lectura y un volumen escribible para la base y los recibos. El esquema se crea o completa solo al arrancar; nunca destruye una base existente.

**La primera cuenta entra siempre** —sin eso una instalación nueva no podría inicializarse— y es el admin. Eso corta en las dos direcciones: una instancia recién levantada y ya pública es de quien llegue primero. Crea la primera cuenta antes de darle nombre público.

## Proxy inverso

El proxy debe reemplazar —no anexar desde el cliente— `X-Forwarded-For`, `X-Forwarded-Host` y `X-Forwarded-Proto`. El guardián de origen compara contra `Host`; si tu proxy lo reescribe con un nombre interno, fija `TABUP_PUBLIC_HOST`.

```nginx
location / {
  client_max_body_size 13m;   # las subidas de recibos aceptan hasta 12 MiB
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_pass http://127.0.0.1:3457;
}
```

## systemd

Instala el standalone en `/opt/tabup` (el `postbuild` ya deja dentro `public` y `.next/static`). Crea el usuario `tabup`, `/var/lib/tabup` con modo `0700` y `/etc/tabup.env` con modo `0600`. Copia `deploy/tabup.service`, `systemctl daemon-reload` y habilita la unidad. El servidor debe tener Node en `/usr/bin/node` o debe ajustarse esa ruta.

## Datos y backups

La base guarda cuentas, viajes, gastos y sesiones; los recibos viven como ficheros bajo `TABUP_DATA_DIR/receipts/`, nunca en la base. Las fotos se re-codifican con sharp al subirse, lo que además elimina EXIF y GPS antes de guardarlas.

No copies sólo `tabup.db` mientras el servicio escribe en modo WAL: usa `sqlite3 /var/lib/tabup/tabup.db '.backup /ruta/backup.db'` y llévate también `receipts/`. `scripts/backup-db.mjs` hace ambas cosas y rota copias (`TABUP_BACKUP_DIR`, `TABUP_BACKUP_KEEP`, `TABUP_BACKUP_REMOTE`).

## Antes de desplegar

`npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `./scripts/run-suites.sh`, `npm audit --omit=dev`, `docker compose config -q`.
