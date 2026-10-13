FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY app ./app
RUN npm run build

FROM node:22-alpine
WORKDIR /srv
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /src/dist ./dist
# Compiled scripts look for these next to themselves.
COPY app/migrations ./dist/app/migrations
COPY app/seed ./dist/app/seed
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/app/scripts/migrate.js && node dist/app/scripts/seed.js && node dist/app/src/main.js"]
