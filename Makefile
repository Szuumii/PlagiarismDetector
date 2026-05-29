.PHONY: start-dev start-dev-docker up down logs db-generate db-migrate db-studio clean install

# Bring up infra (postgres + redis + seaweedfs), ensure the Prisma client and
# package builds exist, then run the api + web dev servers in the foreground.
start-dev: .env node_modules
	docker compose up -d --wait postgres redis seaweedfs
	npx turbo build --filter='./packages/*'
	set -a; . ./.env; set +a; npm run dev

start-dev-docker: .env ## start full stack (api + web + infra) in docker
	docker compose up --build

# --- infra lifecycle ---------------------------------------------------------

up: ## start infra containers (postgres, redis, seaweedfs) and wait until healthy
	docker compose up -d --wait postgres redis seaweedfs

down: ## stop infra containers (data preserved)
	docker compose down

logs: ## tail infra container logs
	docker compose logs -f

clean: ## stop infra and drop volumes (wipes the database)
	docker compose down -v

# --- database ----------------------------------------------------------------

db-generate: ## regenerate the Prisma client
	npm run db:generate

db-migrate: .env ## apply / create migrations (interactive prisma migrate dev)
	set -a; . ./.env; set +a; npm run db:migrate -w @repo/db

db-studio: .env ## open Prisma Studio
	set -a; . ./.env; set +a; npm run db:studio -w @repo/db

# --- bootstrap (real file targets, created on demand) ------------------------

install: ## install all workspace dependencies
	npm install

node_modules: package.json
	npm install
	@touch node_modules

.env:
	cp .env.example .env
