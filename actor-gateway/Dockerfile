FROM node:26-alpine

WORKDIR /workspace/packages/contracts

COPY packages/contracts/package.json packages/contracts/package-lock.json ./
RUN npm ci

COPY packages/contracts/ ./
RUN npm run build

WORKDIR /workspace/actor-gateway

COPY actor-gateway/package.json actor-gateway/package-lock.json ./
RUN npm ci

COPY actor-gateway/ ./

RUN npm run build

EXPOSE 3003

CMD ["npm", "run", "start"]
