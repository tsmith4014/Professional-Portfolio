# Setting Up and Troubleshooting Dockerized Nginx with Custom Port

This guide provides detailed steps to set up a Docker container with Nginx, configure it to serve content on a specific port, troubleshoot common issues, and integrate it with an existing Nginx reverse proxy on an Oracle Cloud instance.

## Prerequisites

- Docker installed on your local machine and the Oracle Cloud instance.
- Access to your DockerHub account.
- Basic knowledge of Docker, Nginx, and firewall settings.
- Existing Nginx setup on Oracle Cloud instance for reverse proxy.

## Steps Overview

1. **Build and Push Docker Image**
2. **Run Docker Container on Oracle Cloud Instance**
3. **Configure Nginx Reverse Proxy on Oracle Cloud Instance**
4. **Troubleshooting Common Issues**
5. **Detailed Steps and Commands**

### 1. Build and Push Docker Image

Build your Docker image with a custom platform and push it to DockerHub.

```sh
# Navigate to your project directory
cd /path/to/your/project

# Build the Docker image for multiple platforms
docker buildx build --platform linux/amd64,linux/arm64 -t tsmith4014/career-page:1.0 .

# Push the image to DockerHub
docker push tsmith4014/career-page:1.0
```

### 2. Run Docker Container on Oracle Cloud Instance

Run your Docker container on the Oracle Cloud instance and map it to port 8000.

```sh
# Pull the Docker image from DockerHub
docker pull tsmith4014/career-page:1.0

# Run the Docker container with port mapping
docker run -d -p 8000:8000 --name career-page tsmith4014/career-page:1.0
```

### 3. Configure Nginx Reverse Proxy on Oracle Cloud Instance

Ensure that your Nginx reverse proxy configuration on the Oracle Cloud instance routes traffic correctly.

Edit the Nginx configuration file:

```sh
sudo vi /etc/nginx/sites-enabled/expenseapp
```

Add or modify the configuration for `devopschad.com`:

```nginx
server {
    listen 80;
    server_name expenseapp.devopschad.com;

    # Redirect all HTTP requests to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name expenseapp.devopschad.com;

    ssl_certificate /etc/letsencrypt/live/expenseapp.devopschad.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/expenseapp.devopschad.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    access_log /var/log/nginx/expenseapp.access.log;
    error_log /var/log/nginx/expenseapp.error.log;

    location / {
        proxy_pass http://localhost:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
}

server {
    if ($host = www.devopschad.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    if ($host = devopschad.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    server_name devopschad.com www.devopschad.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect all HTTP requests to HTTPS
    #return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name devopschad.com www.devopschad.com;

    ssl_certificate /etc/letsencrypt/live/devopschad.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/devopschad.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    access_log /var/log/nginx/devopschad.access.log;
    error_log /var/log/nginx/devopschad.error.log;

    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    ssl_certificate /etc/letsencrypt/live/devopschad.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/devopschad.com/privkey.pem; # managed by Certbot
}
```

Restart Nginx to apply the changes:

```sh
sudo systemctl restart nginx
```

### 4. Troubleshooting Common Issues

#### Issue: 502 Bad Gateway

**Cause:** Nginx inside the container is not listening on the expected port.

**Solution:**

1. **Update the Nginx configuration inside the container to listen on port 8000:**

   ```sh
   docker exec -it <container_id> sh
   vi /etc/nginx/conf.d/default.conf
   ```

   Change the `listen` directives to `8000`:

   ```nginx
   server {
       listen       8000;
       listen  [::]:8000;
       server_name  localhost;
       ...
   }
   ```

2. **Restart Nginx inside the container:**

   ```sh
   nginx -s reload
   ```

3. **Verify Nginx is now listening on port 8000:**

   ```sh
   netstat -tuln | grep 8000
   ```

4. **Check if the content is being served:**

   ```sh
   curl http://localhost:8000
   ```

### 5. Detailed Steps and Commands

#### Build and Push Docker Image

1. **Navigate to your project directory:**

   ```sh
   cd /path/to/your/project
   ```

2. **Build the Docker image:**

   ```sh
   docker buildx build --platform linux/amd64,linux/arm64 -t tsmith4014/career-page:1.0 .
   ```

3. **Push the image to DockerHub:**

   ```sh
   docker push tsmith4014/career-page:1.0
   ```

#### Run Docker Container on Oracle Cloud Instance

1. **Pull the Docker image:**

   ```sh
   docker pull tsmith4014/career-page:1.0
   ```

2. **Run the Docker container:**

   ```sh
   docker run -d -p 8000:8000 --name career-page tsmith4014/career-page:1.0
   ```

#### Configure Nginx Reverse Proxy on Oracle Cloud Instance

1. **Edit the Nginx configuration:**

   ```sh
   sudo vi /etc/nginx/sites-enabled/expenseapp
   ```

2. **Add or modify the server block:**

   ```nginx
   server {
       listen 443 ssl;
       server_name devopschad.com www.devopschad.com;

       ssl_certificate /etc/letsencrypt/live/devopschad.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/devopschad.com/privkey.pem;
       ssl_protocols TLSv1.2 TLSv1.3;
       ssl_ciphers HIGH:!aNULL:!MD5;

       access_log /var/log/nginx/devopschad.access.log;
       error_log /var/log/nginx/devopschad.error.log;

       location / {
           proxy_pass http://localhost:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       location /.well-known/acme-challenge/ {
           root /var/www/certbot;
       }
   }
   ```

3. **Restart Nginx:**

   ```sh
   sudo systemctl restart nginx
   ```

#### Troubleshooting Common Issues

1. **Update the Nginx configuration inside the container:**

   ```sh
   docker exec -it e0bfb890416b sh
   vi /etc/nginx/conf.d/default.conf
   ```

2. **Modify the configuration:**

   ```nginx
   server {
       listen       8000;
       listen  [::]:8000;
       server_name  localhost;
       ...
   }
   ```

3. **Restart Nginx inside the container:**

   ```sh
   nginx -s reload
   ```

4. **Verify Nginx is listening on port 8000:**

   ```sh
   netstat -tuln | grep 8000
   ```

5. **Check if the content is served:**

   ```sh
   curl http://localhost:8000
   ```

## Conclusion

Following these detailed steps ensures your Docker container with Nginx is
