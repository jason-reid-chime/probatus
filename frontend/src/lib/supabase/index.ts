import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  'https://coqpsfvydltujdmwldfi.supabase.com'

const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvcXBzZnZ5ZGx0dWpkbXdsZGZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMzU4NjksImV4cCI6MjA5MDkxMTg2OX0.2IUzA3U9X-C3-9XcNkH5QX-wyG5GMB2M0AAzo4aYH64'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
