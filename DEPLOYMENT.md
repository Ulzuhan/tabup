# Despliegue y operación

TabUp conserva datos duraderos en SQLite y fotos de recibos en disco. Debe ejecutarse como **una sola instancia** detrás de un proxy HTTPS: SQLite, el freno de credenciales y el estado de sesión son locales al proceso.

## Docker Compose

1. Copia `.env.example` a `.env`. Sin nada más, la aplicación funciona con sus propias cuentas; con las cuatro variables OIDC fijadas, entrar es cosa del proveedor (cualquier OIDC estándar: Authentik, Keycloak, Zitadel, Auth0…).
2. Ejecuta `docker compose up -d --build`.
3. Publica únicamente el proxy TLS; Compose enlaza la aplicación a `127.0.0.1:3457`.
4. Con proveedor: `TABUP_ENROLL_URL` decide dónde se pide cuenta. Sin fijarla no se ofrece el botón —que es lo correcto si tu proveedor no tiene alta autoservicio— y con ella aparece en la portada y en cada invitación.
5. `TABUP_ACCOUNT_URL` es la página de la cuenta en tu proveedor (Authentik: `/if/user/`). Correo, contraseña y segundo factor son suyos; sin esta variable la aplicación no enlaza a ninguna parte y quien quiera cambiar su contraseña tiene que saberse la dirección de memoria.

El contenedor corre como UID 10001, sin capacidades, con raíz de solo lectura y un volumen escribible para la base y los recibos. El esquema se crea o completa solo al arrancar; nunca destruye una base existente.

**Con cuentas propias, la primera entra siempre** —sin eso una instalación nueva no podría inicializarse— y es el admin: el único que ve y resuelve las solicitudes de cuenta. Eso corta en las dos direcciones: una instancia recién levantada y ya pública es de quien llegue primero. Crea la primera cuenta antes de darle nombre público.

**Con un proveedor de identidad no hay admin.** Ese papel existe para dejar entrar a la gente y nada más, así que delegando la identidad desaparece entero: no hay panel, ni solicitudes, ni contraseñas que reponer desde dentro. Los fallos del servidor van al log del contenedor (`docker logs`) además de a su tabla. Y añade `TABUP_ENROLL_URL` con el flujo de alta de tu proveedor, o quien llegue sin cuenta no verá dónde pedirla.

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

`npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `./scripts/run-suites.sh`, `npm run test:identity`, `npm audit --omit=dev`, `docker compose config -q`.

`test:identity` va aparte porque es la única suite que necesita el proveedor configurado: si despliegas con OIDC, es la que comprueba lo que cambia por tenerlo.
