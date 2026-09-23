#!/usr/bin/env node
/**
 * scripts/sweep-test-data.mjs
 * 
 * Deletes all @dokan.test test users and their projects from Supabase.
 * Run after every aborted serial e2e run to keep prod clean.
 * 
 * Usage: node scripts/sweep-test-data.mjs
 * 
 * Requires: SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');

function loadEnv() {
  try {
    const text = readFileSync(envPath, 'utf-8');
    const vars = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) vars[m[1]] = m[2].trim();
    }
    return vars;
  } catch {
    console.error('❌ .env.local not found. Copy .env.example → .env.local first.');
    process.exit(1);
  }
}

const env = loadEnv();

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log('🧹 Sweeping test data...\n');

  // 1. List all users — GoTrue admin returns key "users" (NOT "auditors")
  const { data: authData, error: authErr } = await admin.auth.admin.listUsers({ perPage: 500 });
  if (authErr) {
    console.error('❌ Failed to list users:', authErr.message);
    process.exit(1);
  }

  const users = authData.users ?? [];
  const testUsers = users.filter((u) => u.email?.endsWith('@dokan.test'));

  if (testUsers.length === 0) {
    console.log('✅ No @dokan.test users found. Nothing to sweep.');
    process.exit(0);
  }

  console.log(`📋 Found ${testUsers.length} test user(s):`);

  let deletedUsers = 0;
  let deletedProjects = 0;

  for (const user of testUsers) {
    const userId = user.id;
    const email = user.email;
    console.log(`   → ${email} (${userId})`);

    // 2. Delete their projects (service-role PostgREST)
    const { data: projects, error: projErr } = await admin
      .from('staff_members')
      .select('project_id')
      .eq('user_id', userId);

    const projectIds = projects?.map((p) => p.project_id) ?? [];
    for (const pid of projectIds) {
      const { error: delProj } = await admin.from('projects').delete().eq('id', pid);
      if (!delProj) {
        deletedProjects++;
        console.log(`     🗑️  Project ${pid} deleted`);
      }
    }

    // 3. Delete the auth user
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (!delErr) {
      deletedUsers++;
      console.log(`     🗑️  User deleted`);
    } else {
      console.error(`     ❌ Failed to delete user: ${delErr.message}`);
    }
  }

  console.log(`\n✅ Done: ${deletedUsers} user(s), ${deletedProjects} project(s) deleted.`);
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});