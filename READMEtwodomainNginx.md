1. **Check if the Docker container for the career page is running:**
   Ensure that the container is up and running and mapped to the correct port.

   ```bash
   docker ps
   ```

2. **Verify the application inside the Docker container is listening on port 8000:**
   Access the container and check if the application is running and listening on the correct port.

   ```bash
   docker exec -it <container_id> sh
   netstat -tuln | grep 8000
   ```

3. **Verify that the Nginx configuration points to the correct port and the backend service is accessible:**
   Check if Nginx is correctly forwarding requests to the right port.

4. **Check Docker logs for the career page container:**
   Look for any errors or issues that might be preventing the application from starting correctly.

   ```bash
   docker logs <career_page_container_id>
   ```

5. **Ensure that the firewall and security groups allow traffic on the necessary ports:**
   Confirm that the firewall rules are correctly configured to allow traffic on port 8000.

Here are the steps summarized in a detailed README:

## README

### Setting Up Nginx as a Reverse Proxy for Multiple Docker Containers

#### Prerequisites

- Docker installed
- Docker containers running applications on specific ports
- Nginx installed and configured as a reverse proxy
- Certbot installed for SSL certificates

#### Step-by-Step Guide

1. **Update DNS Settings:**

   - Ensure your DNS settings point to your server's IP address.
   - Disable the proxy (orange cloud) for the relevant records if using Cloudflare.

2. **Start Docker Containers:**

   - Ensure your Docker containers are running. For example:
     ```bash
     docker run -d -p 8000:8000 --name career-page tsmith4014/career-page:1.0
     docker run -d -p 8001:8000 --name expense-report tsmith4014/expense_report:finetune2
     ```

3. **Configure Nginx:**

   - Update the Nginx configuration to proxy requests to the Docker containers. Example:

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
         }

         if ($host = devopschad.com) {
             return 301 https://$host$request_uri;
         }

         listen 80;
         server_name devopschad.com www.devopschad.com;

         location /.well-known/acme-challenge/ {
             root /var/www/certbot;
         }

         # Redirect all HTTP requests to HTTPS
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

         ssl_certificate /etc/letsencrypt/live/devopschad.com/fullchain.pem;
         ssl_certificate_key /etc/letsencrypt/live/devopschad.com/privkey.pem;
     }
     ```

4. **Request SSL Certificates:**

   - Use Certbot to request SSL certificates for your domains.
     ```bash
     sudo certbot --nginx -d devopschad.com -d www.devopschad.com
     ```

5. **Restart Nginx:**

   - Restart Nginx to apply the changes.
     ```bash
     sudo systemctl restart nginx
     ```

6. **Troubleshoot Common Issues:**
   - Check if the Docker containers are running and accessible.
   - Verify the application logs for any errors.
   - Ensure the firewall allows traffic on the necessary ports.

#### Additional Notes

- Ensure your Docker containers are correctly configured and the applications are running as expected.
- Use `docker logs <container_id>` to check the logs of your Docker containers for any issues.

This README provides a comprehensive guide to setting up Nginx as a reverse proxy for multiple Docker containers and troubleshooting common issues.
