#!/bin/sh
set -e

# With arguments (e.g. create-user <email>), run the administrative command and exit.
if [ "$#" -gt 0 ]; then
  exec dotnet /app/ProtocoloApp.Api.dll "$@"
fi

if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
  echo "Applying migrations..."
  /app/efbundle --connection "$ConnectionStrings__Db"
fi

exec dotnet /app/ProtocoloApp.Api.dll
