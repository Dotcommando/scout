FROM node:26-alpine

WORKDIR /workspace/packages/contracts

COPY packages/contracts/package.json packages/contracts/package-lock.json ./
RUN npm ci

COPY packages/contracts/ ./
RUN npm run build

WORKDIR /workspace/bff

COPY bff/package.json bff/package-lock.json ./
RUN npm ci

COPY bff/ ./
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
