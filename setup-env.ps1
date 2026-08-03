npx vercel link --project buddysaradhi --yes

npx vercel env add NEXT_PUBLIC_SUPABASE_URL production --value "https://gmqwdnvbfnwpzpctwvho.supabase.co" --yes
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production --value "<SUPABASE_ANON_KEY>" --yes
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production --value "<SUPABASE_SERVICE_ROLE_KEY>" --yes
npx vercel env add SUPABASE_PUBLISHABLE_KEY production --value "<SUPABASE_PUBLISHABLE_KEY>" --yes
npx vercel env add SUPABASE_SECRET_KEY production --value "<SUPABASE_SECRET_KEY>" --yes

npx vercel env add TURSO_API_TOKEN production --value "<TURSO_API_TOKEN>" --yes
npx vercel env add TURSO_ORGANISATION_NAME production --value "harish2222" --yes
npx vercel env add TURSO_ORGANISATION_SLUG production --value "harish2222" --yes


npx vercel link --project buddysaradhi-product-page --yes

npx vercel env add BLOB_READ_WRITE_TOKEN production --value "<BLOB_READ_WRITE_TOKEN>" --yes
npx vercel env add BLOB_PRIVATE_BASE_URL production --value "https://5gv6xmws8qnwry4s.private.blob.vercel-storage.com" --yes
npx vercel env add BLOB_STORE_ID production --value "store_5gV6XmWS8QNwrY4S" --yes
