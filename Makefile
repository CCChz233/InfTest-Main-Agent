BUN := /Users/chz/.bun/bin/bun
export PATH := /Users/chz/.bun/bin:$(PATH)

.PHONY: typecheck build dev fake-e2e available-agents-e2e query-e2e query-e2e-stepwise api-e2e-fake api-e2e-query server

typecheck:
	$(BUN) run typecheck

build:
	$(BUN) run build

dev:
	$(BUN) run dev

fake-e2e:
	$(BUN) run scripts/inftest_fake_e2e.ts

available-agents-e2e:
	$(BUN) run scripts/inftest_available_agents_e2e.ts

query-e2e:
	$(BUN) run scripts/inftest_query_e2e.ts

query-e2e-stepwise:
	$(BUN) run scripts/inftest_query_e2e_stepwise.ts

api-e2e-fake:
	$(BUN) run scripts/inftest_api_e2e_fake.ts

api-e2e-query:
	$(BUN) run scripts/inftest_api_e2e_query.ts

server:
	$(BUN) run scripts/inftest_task_api.ts
