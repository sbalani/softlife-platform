UPDATE public.profiles SET scope_version = COALESCE(scope_version, 1) + 1;
