FROM node:26-alpine

WORKDIR /workspace/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

EXPOSE 4200

CMD ["npm", "run", "start"]
