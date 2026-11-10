alter table public.staff_members
  add column if not exists sex text
    check (sex is null or sex in ('male', 'female', 'prefer_not_to_say')),
  add column if not exists residence text
    check (residence is null or char_length(residence) <= 200);

notify pgrst, 'reload schema';
