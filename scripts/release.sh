#!/usr/bin/env bash

VERSION_REGEX="(?<=version\":\s\")([0-9.]+)"
# shellcheck disable=SC2034
OUTPUT_DIR="./dist/"
# shellcheck disable=SC2207
version=($(grep -Po "$VERSION_REGEX" "package.json"))
files="$(find $OUTPUT_DIR -maxdepth 1 -type f)"

files=$(echo "$files" | grep -vE "debug.yml|.blockmap")

# shellcheck disable=SC2128
echo "Found version: \"$version\""
echo "Found files: \"$files\""


if [ "$(gh release list | grep -F "$version")" != "" ]; then
  gh release delete "$version" && gh api repos/:owner/:repo/git/refs/tags/"$version" -X DELETE
fi

# Parse COMMIT_MESSAGE variables
string=$COMMIT_MESSAGE
COMMIT_MESSAGE=""

len=${#string}
finalString=""
i=0
while [ $i -lt "$len" ]; do
  char=${string:i:1}
  i=$((i + 1))
  if [ "$char" == "$" ]; then
    var=""
    for j in $(seq $i "$len"); do
      var="$var${string:j:1}"
      for invalid in invalid var string i j finalString len tmp val COMMIT_MESSAGE; do
        test "$var" == "$invalid" && continue 2
      done
      val=${!var}
      if [ "$val" != "" ]; then
        i=$((j + 1))
        finalString="$finalString$val"
        continue 2
      fi
    done
  fi
  finalString="$finalString$char"
done

COMMIT_MESSAGE=$finalString

# shellcheck disable=SC2086
gh release create "$version" \
  --repo="$GITHUB_REPOSITORY" \
  --title="$REPOSITORY_NAME $version" \
  --notes="$COMMIT_MESSAGE" \
  --latest $files