FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Tencent CloudBase Run is probing port 80 for this service.
ENV PORT=80
EXPOSE 80

CMD ["npm", "start"]
