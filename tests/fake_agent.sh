#!/usr/bin/env bash
# CLI falso para tests: imprime salida, pide "aprobación", lee una respuesta y
# termina con el código 3.
echo "fake agent: arrancando"
for i in 1 2 3; do
  echo "trabajando paso $i  OPENAI_API_KEY=no-deberia-verse"
  sleep 0.2
done
printf '¿Aprobar el cambio? (y/n) '
read -r answer
echo "respuesta: $answer"
sleep "${FAKE_AGENT_LINGER:-0}"
exit 3
