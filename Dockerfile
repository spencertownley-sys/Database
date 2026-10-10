FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN chmod +x docker-start.sh

ENV DATABASE_URL=postgresql://user:pass@localhost:5432/placeholder
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["./docker-start.sh"]
