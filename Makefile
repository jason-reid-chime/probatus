.PHONY: dev-frontend dev-backend dev-docker build-backend build-frontend deploy-api deploy-gotenberg db-migrate db-seed

dev-frontend:
	cd frontend && npm run dev

dev-backend:
	cd backend && air 2>/dev/null || go run ./cmd/api

dev-docker:
	docker compose up

build-backend:
	cd backend && go build -o ./bin/probatus ./cmd/api

build-frontend:
	cd frontend && npm run build

deploy-api:
	fly deploy --config fly.toml

deploy-gotenberg:
	fly deploy --config fly.gotenberg.toml

db-migrate:
	supabase db push

db-seed:
	supabase db reset --db-url $$DATABASE_URL
