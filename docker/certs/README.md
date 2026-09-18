# Extra root certificates for the dev containers (optional)

Leave this folder empty unless your network sits behind a TLS-inspecting proxy (Cato, Zscaler,
Netskope, ...). Behind one, the host trusts the proxy's root CA but containers do not, and
downloads fail with `self-signed certificate in certificate chain` — typically Prisma fetching its
schema engine from `binaries.prisma.sh`.

The fix is to trust that same CA inside the containers. Traffic is still inspected; nothing is
bypassed. **Never** reach for `NODE_TLS_REJECT_UNAUTHORIZED=0` instead.

1. Export the proxy's **root** certificate as PEM into this folder, with a `.crt` extension.
   On macOS:

   ```sh
   security find-certificate -c "Cato Networks Root CA" -p /Library/Keychains/System.keychain \
     > docker/certs/corporate-root-ca.crt
   ```

2. `docker compose build`

Every `*.crt` here is concatenated into `/etc/ssl/extra-ca.pem` in the image, and
`docker/entrypoint.sh` points `NODE_EXTRA_CA_CERTS` at it. With no certificate the whole
mechanism is a no-op. Certificates in this folder are git-ignored: they describe your network,
not the project.
