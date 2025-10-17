# Prisma + Supabase Setup Guide

## Quick Start

### 1. Get your Supabase Database URL

1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **Database**
3. Under **Connection string**, copy the **Connection pooling** URI
4. It should look like: `postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres`

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Update the `DATABASE_URL` in `.env`:

```env
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Note:** For connection pooling with Supabase, add `?pgbouncer=true` at the end.

### 3. Run Database Migration

```bash
# Push the schema to your Supabase database
npm run db:push

# Or create and run a migration
npm run db:migrate
```

### 4. Generate Prisma Client

```bash
npm run prisma:generate
```

### 5. Start the Server

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

## Prisma Commands

### Database Operations

```bash
# Push schema changes to database (good for development)
npm run db:push

# Create a new migration
npm run db:migrate

# Open Prisma Studio (visual database editor)
npm run db:studio

# Generate Prisma Client after schema changes
npm run prisma:generate
```

### Useful Prisma CLI Commands

```bash
# Format the Prisma schema file
npx prisma format

# Validate the Prisma schema
npx prisma validate

# Pull the current database schema into Prisma
npx prisma db pull

# Reset the database (⚠️ deletes all data)
npx prisma migrate reset
```

## Schema Updates

When you modify `prisma/schema.prisma`:

1. **Development:**

   ```bash
   npm run db:push
   npm run prisma:generate
   ```

2. **Production:**
   ```bash
   npm run db:migrate
   npm run prisma:generate
   ```

## Troubleshooting

### Connection Issues

If you can't connect to Supabase:

1. **Check your DATABASE_URL** format
2. **Verify your password** doesn't contain special characters that need URL encoding
3. **Use connection pooling URL** for better performance
4. **Whitelist your IP** in Supabase dashboard (if using direct connection)

### URL Encoding Special Characters

If your password contains special characters, encode them:

- `@` → `%40`
- `:` → `%3A`
- `/` → `%2F`
- `?` → `%3F`
- `#` → `%23`

Example:

```
# Original password: MyP@ss:123
# Encoded: MyP%40ss%3A123
DATABASE_URL=postgresql://postgres:MyP%40ss%3A123@...
```

### Prisma Client Not Found

If you get "Cannot find module '@prisma/client'":

```bash
npm install @prisma/client
npm run prisma:generate
```

## Supabase-Specific Tips

1. **Connection Pooling**: Use the pooler URL for better performance

   ```
   postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
   ```

2. **Direct Connection**: Use for migrations and admin tasks

   ```
   postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
   ```

3. **Row Level Security (RLS)**: Prisma bypasses RLS by default. For RLS, consider using Supabase client for specific operations.

## Database Schema

Current models in `prisma/schema.prisma`:

- **User**: Authentication and user data
  - id (String/CUID)
  - email (unique)
  - password (hashed)
  - name
  - avatar
  - isVerified
  - refreshToken
  - searchHistory (JSON array)
  - preferences (JSON object)
  - timestamps

## Next Steps

1. Set up your Supabase project
2. Copy your connection string
3. Update `.env` file
4. Run `npm run db:push`
5. Start building! 🚀
