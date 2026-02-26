@echo off
echo === OSTANOVKA ===
taskkill /F /IM node.exe
taskkill /F /IM ngrok.exe
docker-compose down

echo === SBORKA ===
npm run build

echo === ZAPUSK SERVER ===
docker-compose up -d
npm run start:prod
