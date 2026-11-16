update public.staff_roles
set permissions = array_remove(
  array_remove(permissions, 'account_status_management'),
  'account_deletion'
)
where not ('accounts' = any(permissions))
  and permissions && array['account_status_management', 'account_deletion']::text[]
  and cardinality(array_remove(
    array_remove(permissions, 'account_status_management'),
    'account_deletion'
  )) > 0;
