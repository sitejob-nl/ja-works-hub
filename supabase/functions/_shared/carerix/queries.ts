// Carerix GraphQL queries.
//
// Two query families:
//   1. v1 public schema: companyPage, contactPage, candidatePage, vacancyPage.
//      Minimal fields, low scope requirements.
//   2. CR*-schema (legacy but rich): crCompanyPage, crEmployeePage, crMatchPage,
//      crJobPage, crPublicationPage, crEmploymentPage, crAttachmentPage,
//      crTodoPage. Requires `urn:cx/cx5Wrapper:data:manage` (or equivalent
//      per-resource manage scope).
//
// All cr*Page-queries accept an optional `qualifier` for filtering. We use that
// for delta-syncs: `modificationDate >= (NSCalendarDate) '2026-04-28 00:00:00 +0200'`.
// Page hard limit on Carerix side is 100 — keep `size` <= 100.

function pageable(page: number, size: number): string {
  return `pageable: { page: ${page}, size: ${size} }`;
}

function qualifierClause(qualifier?: string): string {
  if (!qualifier) return '';
  // Escape any double-quotes in the qualifier itself.
  const safe = qualifier.replace(/"/g, '\\"');
  return `, qualifier: "${safe}"`;
}

// For migration we want soft-deleted/archived records too — vervulde vacatures,
// afgeronde plaatsingen, gesloten matches. Default is false on Carerix side
// which silently filters them out, leading to surprising "0 found" results.
const NORESTRICT = ', norestrict: true';

// ---------- v1 public schema ----------

export function companiesQuery(page: number, size: number): string {
  return `query {
    companyPage(${pageable(page, size)}) {
      totalElements
      items {
        _id
        name
        displayName
      }
    }
  }`;
}

export function contactsQuery(page: number, size: number): string {
  return `query {
    contactPage(${pageable(page, size)}) {
      totalElements
      items {
        _id
        firstName
        lastName
        displayName
        company { _id name }
        emailAddresses {
          items { value primary }
        }
      }
    }
  }`;
}

export function candidatesQuery(page: number, size: number): string {
  return `query {
    candidatePage(${pageable(page, size)}) {
      totalElements
      items {
        _id
        firstName
        lastName
        displayName
        emailAddresses {
          items { value primary }
        }
      }
    }
  }`;
}

export function vacanciesV1Query(page: number, size: number): string {
  return `query {
    vacancyPage(${pageable(page, size)}) {
      totalElements
      items {
        _id
        jobTitle
        displayName
      }
    }
  }`;
}

export function connectionTestQuery(): string {
  return `query {
    companyPage(pageable: { page: 0, size: 1 }) {
      totalElements
    }
  }`;
}

// ---------- CR*-schema (rich) ----------

export function crCompaniesQuery(page: number, size: number, qualifier?: string): string {
  return `query {
    crCompanyPage(${pageable(page, size)}${NORESTRICT}${qualifierClause(qualifier)}) {
      totalElements
      items {
        _id
        name
        displayName
        modificationDate
      }
    }
  }`;
}

export function crEmployeesQuery(page: number, size: number, qualifier?: string): string {
  return `query {
    crEmployeePage(${pageable(page, size)}${NORESTRICT}${qualifierClause(qualifier)}) {
      totalElements
      items {
        _id
        firstName
        lastName
        displayName
        emailAddress
        phoneNumber
        applySource
        birthDate
        nationality
        city
        postalCode
        country
        creationDate
        modificationDate
        toStatusNode { _id value }
        toUser { _id displayName }
      }
    }
  }`;
}

export function crJobsQuery(page: number, size: number, qualifier?: string): string {
  // CRJob field-names per docs.carerix.io/graphql/types/CRJob:
  //   name (NOT title), jobInformation (NOT description),
  //   hourlyTariffInvoice (NOT hourlyRate), templateName (NOT displayName).
  return `query {
    crJobPage(${pageable(page, size)}${NORESTRICT}${qualifierClause(qualifier)}) {
      totalElements
      items {
        _id
        name
        jobInformation
        templateName
        startDate
        endDate
        hourlyTariffInvoice
        creationDate
        modificationDate
        status
        statusDisplay
        toCompany { _id name }
        toUser { _id name }
      }
    }
  }`;
}

export function crPublicationsQuery(page: number, size: number, qualifier?: string): string {
  return `query {
    crPublicationPage(${pageable(page, size)}${NORESTRICT}${qualifierClause(qualifier)}) {
      totalElements
      items {
        _id
        publicationStart
        publicationEnd
        modificationDate
        toMedium { _id name }
        toStatusNode { _id value }
        toJob { _id displayName }
        toVacancy { _id displayName }
      }
    }
  }`;
}

export function crMatchesQuery(page: number, size: number, qualifier?: string): string {
  // CRMatch field-names per docs.carerix.io/graphql/types/CRMatch:
  //   fitScore (NOT matchScore), toVacancy (NOT toPublication/toJob),
  //   statusInfo direct on match (NOT toStatusInfo).
  //   CREmployee has no displayName — use firstName+lastName.
  return `query {
    crMatchPage(${pageable(page, size)}${NORESTRICT}${qualifierClause(qualifier)}) {
      totalElements
      items {
        _id
        fitScore
        applySource
        applyMedium
        creationDate
        modificationDate
        statusDisplay
        statusInfo { _id label value }
        toEmployee { _id firstName lastName }
        toVacancy { _id name }
        owner { _id name }
      }
    }
  }`;
}

// NOTE: crEmploymentPage does NOT exist in Carerix schema. Placements are
// modeled as CRMatch (with placed-status) or as CRJob with toEmployee.
// Kept here purely as documentation — the runner marks `placements` UNSUPPORTED.
export function crEmploymentsQuery(_page: number, _size: number, _qualifier?: string): string {
  throw new Error('crEmploymentPage bestaat niet in Carerix schema');
}

export function crAttachmentsQuery(page: number, size: number, qualifier?: string): string {
  // CRAttachment field-names per docs.carerix.io/graphql/types/CRAttachment:
  //   downloadName / displayName (filename), attachmentMimeType (NOT mimeType),
  //   label (NOT tag), attachmentSize (NOT fileSize).
  //   CRAttachment has NO direct toEmployee/toCompany/toJob refs — the parent
  //   relation is reverse: CREmployee.attachments. For migration we'd need a
  //   per-candidate fetch via crEmployee(_id).attachments. For now we just
  //   list attachment metadata; runner attaches them via a second pass later.
  return `query {
    crAttachmentPage(${pageable(page, size)}${NORESTRICT}${qualifierClause(qualifier)}) {
      totalElements
      items {
        _id
        downloadName
        displayName
        attachmentMimeType
        label
        attachmentSize
        creationDate
        modificationDate
      }
    }
  }`;
}

// Single-attachment fetch (separate call because base64 payloads are large).
export function crAttachmentContentQuery(attachmentId: string): string {
  const safe = attachmentId.replace(/"/g, '\\"');
  return `query {
    crAttachment(_id: "${safe}") {
      _id
      fileName
      mimeType
      content
    }
  }`;
}

export function crTodosQuery(page: number, size: number, qualifier?: string): string {
  // Query name is `crToDoPage` (camelCase, capital D, NOT crTodoPage).
  // Field list kept minimal until full CRToDo schema is confirmed.
  return `query {
    crToDoPage(${pageable(page, size)}${NORESTRICT}${qualifierClause(qualifier)}) {
      totalElements
      items {
        _id
        creationDate
        modificationDate
      }
    }
  }`;
}

// Helper: build a `modificationDate >= '<watermark>'` qualifier for delta-sync.
export function watermarkQualifier(modifiedSince: string | null | undefined): string | undefined {
  if (!modifiedSince) return undefined;
  // Carerix REST docs say datums need explicit timezone; for GraphQL it accepts
  // ISO-8601 with offset just fine (we format in UTC with +0000).
  const d = new Date(modifiedSince);
  if (isNaN(d.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatted =
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
  return `modificationDate >= (NSCalendarDate) '${formatted}'`;
}
