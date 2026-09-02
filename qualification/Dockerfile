FROM node:26-alpine

WORKDIR /workspace/packages/contracts

COPY packages/contracts/package.json packages/contracts/package-lock.json ./
RUN npm ci

COPY packages/contracts/ ./
RUN npm run build

WORKDIR /workspace/qualification

COPY qualification/package.json qualification/package-lock.json ./
RUN npm ci

COPY qualification/ ./

RUN npm run build

EXPOSE 3002

CMD ["npm", "run", "start"]
