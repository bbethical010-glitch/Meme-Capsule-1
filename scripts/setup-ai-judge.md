# AI Judge setup

Run the D1 migration:

```bash
npx wrangler d1 execute <db-name> --file=d1/migrations/004_ai_judge.sql
```

Generate a password hash:

```bash
node -e "const c=require('crypto');console.log(c.createHash('sha256').update('YOUR_PASSWORD').digest('hex'))"
```

Update the default operator hash:

```sql
UPDATE ai_judge_users SET password_hash = 'YOUR_HASH' WHERE username = 'aijudge';
```

Then log in at `/ai-judge`, save your provider key, and start a run.
