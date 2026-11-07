# Fase 8B: seguimiento de entrega con Resend

La Fase 8B conserva el despacho automático de 8A.2. El webhook solo actualiza el resultado de entrega después de que Resend aceptó un mensaje; nunca inicia otro envío ni reintenta uno.

## Preparación

1. Ejecuta una vez `supabase/17_resend_webhooks_delivery.sql` en el SQL Editor del proyecto Supabase.
2. En Resend, crea un webhook para estos eventos: `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed` y `email.suppressed`.
3. Copia el **signing secret `whsec_...`** del webhook (no la API Key `re_...`) en `RESEND_WEBHOOK_SECRET` dentro de `rrhh-backend/.env`, y cambia `RESEND_WEBHOOKS_ENABLED=true`.
4. Mantén el secreto fuera de comandos, repositorios, capturas y logs.

## Levantarlo localmente en macOS

Abre tres terminales en `talentAI_Updatev2/rrhh-backend`:

**Terminal 1: backend.** El `.env` de desarrollo tiene `RESEND_AUTO_ENABLED=true`; el override desactiva el despacho mientras se prueba el webhook.

```sh
RESEND_AUTO_ENABLED=false RAG_AUTO_INDEX_ENABLED=false npm start
```

**Terminal 2: proxy limitado.** Solo publica `POST /api/webhooks/resend` y reenvía el cuerpo crudo junto a las cabeceras `svix-*`.

```sh
node scripts/webhook-only-proxy.js
```

**Terminal 3: Cloudflare Quick Tunnel.**

```sh
~/.local/bin/cloudflared tunnel --url http://127.0.0.1:3001
```

Cloudflare imprimirá una URL `https://...trycloudflare.com`. Registra en Resend esta URL seguida de `/api/webhooks/resend`, por ejemplo `https://<túnel>.trycloudflare.com/api/webhooks/resend`. Quick Tunnel cambia de URL al reiniciarse; actualiza la URL en Resend cada vez.

## Diagnóstico rápido

- El mensaje `~/.zprofile:1: no such file or directory: /usr/local/bin/brew` viene de una referencia vieja a Homebrew en el perfil de zsh. No es un error de `cloudflared`: el binario está instalado en `~/.local/bin/cloudflared`. Para quitar el aviso, corrige o elimina en `~/.zprofile` la línea que llama a `/usr/local/bin/brew` si Homebrew ya no está en esa ruta.
- Si Cloudflare muestra `connection refused`, confirma primero que el proxy escucha en `127.0.0.1:3001` y que el backend escucha en el puerto `3000` (`PORT` puede cambiarlo; en ese caso configura `RESEND_WEBHOOK_PROXY_PORT`/`PORT` de forma coherente).
- Si el proxy devuelve `503`, confirma que el backend está activo, que el webhook está habilitado, que el secreto corresponde al webhook de Resend y que la migración SQL 17 está aplicada.
- Un `404` para `GET /` o para otras rutas es intencional: el proxy no expone el resto del backend.
- `email.delivered` significa que el servidor destinatario aceptó el mensaje; no confirma lectura ni ubicación en la bandeja principal.

Verificación de esquema y permisos: `supabase/17_verify_resend_webhooks.sql`. Pruebas automatizadas: `cd rrhh-backend && npm test`.
