FROM node:26-alpine

WORKDIR /workspace/packages/contracts

COPY packages/contracts/package.json packages/contracts/package-lock.json ./
RUN npm ci

COPY packages/contracts/ ./
RUN npm run build

WORKDIR /workspace/discovery

COPY discovery/package.json discovery/package-lock.json ./
RUN npm ci

COPY discovery/ ./

RUN npm run build

EXPOSE 3001

CMD ["npm", "run", "start"]
