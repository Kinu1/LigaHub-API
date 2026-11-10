.PHONY: build-ApiFunction build-EmailFunction build-PaymentFunction

build-ApiFunction build-EmailFunction build-PaymentFunction:
	node scripts/package-lambda.mjs "$(ARTIFACTS_DIR)"
