# Stage 1: Build Stage
FROM node:14-alpine AS build-stage
WORKDIR /app
# COPY home.html /app
# COPY favicon.ico /app
COPY . /app

# Stage 2: Final Stage
FROM nginx:alpine
COPY --from=build-stage /app /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8000
CMD ["nginx", "-g", "daemon off;"]