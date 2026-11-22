-- Display names must be visible and unambiguous (phase 10 review): no control
-- characters (Unicode Cc), no format characters (Cf: zero-width spaces and
-- joiners, bidi controls, BOM…), no leading or trailing whitespace of any
-- kind, and at least one letter or digit. The front end normalises names the
-- same way before saving (src/people/profile.ts).
--
-- The Cc, Cf and whitespace sets are spelled out as code points so they don't
-- depend on the locale; [[:alnum:]] uses the database's ICU locale, which
-- knows every script (Inês, Zé, Ζωή, 李). Adding the constraint checks the
-- existing rows: the migration fails, changing nothing, if any name breaks it.

alter table public.profiles
  add constraint profiles_display_name_visible check (
    -- Cc (U+0000 can't be stored in text anyway)
    display_name !~ '[\u0001-\u001f\u007f-\u009f]'
    -- Cf (Unicode 15.1)
    and display_name !~ '[­؀-؅؜۝܏࢐࢑࣢᠎​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'
    -- Unicode White_Space at either end (the ASCII ones are Cc or a space)
    and display_name !~ '^[    -     　]'
    and display_name !~ '[    -     　]$'
    and display_name ~ '[[:alnum:]]'
  );

comment on constraint profiles_display_name_visible on public.profiles is
  'No control or format characters, no whitespace at either end, at least one letter or digit.';
