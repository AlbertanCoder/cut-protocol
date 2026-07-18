FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-slim
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/ ./
RUN npx prisma generate
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
