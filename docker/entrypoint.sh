#!/bin/sh
# Trust the optional corporate root CAs baked in from docker/certs (see its README).
if [ -s /etc/ssl/extra-ca.pem ]; then
  export NODE_EXTRA_CA_CERTS=/etc/ssl/extra-ca.pem
fi
exec "$@"
