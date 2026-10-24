.PHONY: install dev dev-web dev-worker test lint typecheck integration-test e2e build docker-up docker-down

install:
	pnpm install --frozen-lockfile

## Local dev without Docker: worker (in-memory queue if REDIS_URL is unset) + web.
dev:
	@echo "Run 'make dev-worker' and 'make dev-web' in two terminals (or 'make docker-up')."
dev-worker:
	cd apps/worker && WORKER_API_TOKEN=dev-worker-token-change-me PUBLIC_URL=http://localhost:8080 CORS_ORIGINS=http://localhost:3000 pnpm dev
dev-web:
	cd apps/web && WORKER_URL=http://localhost:8080 WORKER_API_TOKEN=dev-worker-token-change-me NEXT_PUBLIC_WORKER_PUBLIC_URL=http://localhost:8080 pnpm dev

lint:
	pnpm lint
typecheck:
	pnpm typecheck
## Unit tests (core, worker unit, web).
test:
	pnpm --filter @justdownload/core test && pnpm --filter @justdownload/worker test && pnpm --filter @justdownload/web test
## Worker integration tests (real FFmpeg). Set REDIS_URL to include the Redis/BullMQ suite.
integration-test:
	pnpm --filter @justdownload/worker test:integration
## Playwright. Set E2E_WORKER_URL/E2E_WORKER_TOKEN to run the full-pipeline suite against a running worker.
e2e:
	cd apps/web && pnpm build && pnpm test:e2e
build:
	pnpm build

docker-up:
	docker compose up --build
docker-down:
	docker compose down
