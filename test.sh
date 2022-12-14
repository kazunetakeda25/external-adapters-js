#!/bin/bash

# Mode is either "readme" or anything else
# When "readme" is passed, the script will echo a space seperated list of EAs to pass to `yarn generate:readme` (Ex: "coinmarketcap coinpaprika coingecko")
# When anything else is passed, the script will return the build matrix output: {adapter: [{name: "coingecko-adapter", "type": "sources"}, {name: "coinpaprika-adapter", "type": "sources"}]}
MODE=matrix
UPSTREAM_BRANCH=develop
BASE=$(yarn workspaces list -R --since="origin/$UPSTREAM_BRANCH" --json)
echo $BASE

# Check if a core or script package has changed
# Note, legos will ALWAYS change on any adapter change since it depends on all adapters
# Modifications to legos are rare enough that we can ignore it if it's the only core change that appears in the diff
CONTAINS_CORE_OR_SCRIPTS=$(echo "$BASE" | grep -E '(core)' | grep -v "core/legos")
# TODO @ad0ll, scripts commented below to test
#CONTAINS_CORE_OR_SCRIPTS=$(echo "$BASE" | grep -E '(core|scripts)' | grep -v "core/legos")
if [[ -n $CONTAINS_CORE_OR_SCRIPTS ]]; then
  echo "BUILD_ALL"
  exit 0
fi

# Extract EAs from the `yarn workspaces` diff, then format them into build-matrix format while also handling
# the string replacements. If MODE is matrix, this results in a JSON string in the format of: {adapter: [{name: "coingecko-adapter", "type": "sources"}, {name: "coinpaprika-adapter", "type": "sources"}]}
OUTPUT=$(echo "$BASE" |
jq '
select(.location | match("(sources|composites|examples|non-deployable|targets)")) |
{type: .location | match("packages/(.*)/.*") | .captures[0].string,
name: .name | match("@chainlink/(.*)-adapter") | .captures[0].string}
' |
jq -s '{ adapter: . }')

# Change to space separated list when it's a readme
if [[ "$MODE" == "readme" ]]; then
  OUTPUT=$(
    echo "$OUTPUT" |
    # Strip example adapters from list since generate:readme doesn't work on them
    # Then output all adapters as a space separated list (-j means raw output, i.e. no newlines)
    jq -j '.adapter[].name | select(. | contains("example") | not) + " "'
  )
fi

echo "$OUTPUT"