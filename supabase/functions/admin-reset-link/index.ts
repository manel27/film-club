import { issueLink } from '../_shared/links.ts'

Deno.serve((req) => issueLink(req, 'reset'))
