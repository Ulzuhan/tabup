FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3457 TABUP_DB=/data/tabup.db TABUP_DATA_DIR=/data
WORKDIR /app
RUN groupadd --system --gid 10001 tabup && useradd --system --uid 10001 --gid tabup --home /nonexistent tabup \
    && mkdir /data && chmod 0700 /data && chown tabup:tabup /data
COPY --from=build --chown=tabup:tabup /app/.next/standalone ./
USER tabup
EXPOSE 3457
# Sin seguir redirecciones: /login responde 200 con cuentas propias y redirige al
# proveedor con OIDC; ambos son "vivo". Solo un 5xx (o no responder) es estar caído.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3457/login',{redirect:'manual'}).then(r=>{if(r.status>=500)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
