# Multi-stage build for a small production image
FROM docker.io/library/node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Build app
COPY . .
RUN npm run build

# Runtime image
FROM docker.io/library/nginx:1.27-alpine AS runtime

# Replace default nginx config with SPA-friendly config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
