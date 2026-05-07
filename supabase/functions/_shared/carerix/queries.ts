// Carerix GraphQL queries.
//
// Two query families:
//   1. v1 public schema: companyPage, contactPage, candidatePage. Minimal fields.
//   2. CR*-schema (legacy maar rijk): crEmployeePage, crMatchPage, crJobPage,
//      crWorkHistoryPage, crToDoPage. Vereist `urn:cx/cx5Wrapper:data:manage`
//      (of equivalent per-resource manage scope).
//
// Alle cr*Page-queries accepteren een optionele `qualifier` voor delta-syncs
// en `norestrict: true` om soft-deleted/archived records mee te krijgen
// (cruciaal voor migratie).

function pageable(page: number, size: number): string {
  return `pageable: { page: ${page}, size: ${size} }`;
}

function qualifierClause(qualifier?: string): string {
  if (!qualifier) return '';
  const safe = qualifier.replace(/"/g, '\\"');
  return `, qualifier: "${safe}"`;
}

const NORESTRICT = ', norestrict: true';

// ---------- v1 public schema (minimaal) ----------

export function companiesQuery(page: number, size: number): string {
  return `query {
    companyPage(${pageable(page, size)}) {
      totalElements last
      items { _id name displayName }
    }
  }`;
}

export function contactsQuery(page: number, size: number): string {
  return `query {
    contactPage(${pageable(page, size)}) {
      totalElements last
      items {
        _id firstName lastName displayName
        company { _id name }
        emailAddresses { items { value primary } }
      }
    }
  }`;
}

export function candidatesQuery(page: number, size: number): string {
  return `query {
    candidatePage(${pageable(page, size)}) {
      totalElements last
      items {
        _id firstName lastName displayName
        emailAddresses { items { value primary } }
      }
    }
  }`;
}

export function connectionTestQuery(): string {
  return `query { companyPage(pageable: { page: 0, size: 1 }) { totalElements } }`;
}

export function richSchemaConnectionTestQuery(): string {
  return `query {
    crEmployeePage(pageable: { page: 0, size: 1 }, norestrict: true) {
      totalElements
    }
  }`;
}

// ---------- CR*-schema (rijk) ----------

export function crEmployeesQuery(page: number, size: number, qualifier?: string): string {
  // Uitgebreid met home*-adresvelden, mobileNumber/businessEmail. Carerix slaat
  // adres/telefoon op de TOP-level CREmployee, niet in subobjects.
  return `query {
    crEmployeePage(${pageable(page, size)}${NORESTRICT}${qualifierClause(qualifier)}) {
      totalElements last
      items {
        _id
        firstName
        lastName
        fullFirstNames
        emailAddress
        emailAddressBusiness
        phoneNumber
        mobileNumber
        phoneNumberBusiness
        birthDate
        homeStreet
        homeNumber
        homeNumberSuffix
        homePostalCode
        homeCity
        creationDate
        modificationDate
      }
    }
  }`;
}

export function crJobsQuery(page: number, size: number, qualifier?: string): string {
  // jobInformation, hourlyTariffInvoice zijn @qualifiable scalars in CRJob.
  // memoGeneral als description-fallback.
  return `query {
    crJobPage(${pageable(page, size)}${NORESTRICT}${qualifierClause(qualifier)}) {
      totalElements last
      items {
        _id
        name
        jobInformation
        memoGeneral
        templateName
        startDate
        endDate
        hourlyTariffInvoice
        hourlyWageGross
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

export function crMatchesQuery(page: number, size: number, qualifier?: string): string {
  // CRStatusInfo gebruikt `name` (geen `value`).
  // CRVacancy gebruikt `jobTitle` (geen `name`).
  return `query {
    crMatchPage(${pageable(page, size)}${NORESTRICT}${qualifierClause(qualifier)}) {
      totalElements last
      items {
        _id
        fitScore
        applySource
        applyMedium
        creationDate
        modificationDate
        statusDisplay
        statusInfo { _id label name }
        toEmployee { _id firstName lastName }
        toVacancy { _id jobTitle }
      }
    }
  }`;
}

export function crWorkHistoriesQuery(page: number, size: number, qualifier?: string): string {
  return `query {
    crWorkHistoryPage(${pageable(page, size)}${NORESTRICT}${qualifierClause(qualifier)}) {
      totalElements last
      items {
        _id
        startDate
        endDate
        employer
        function
        workLocation
        endReason
        creationDate
        modificationDate
        toEmployee { _id }
        toCompany { _id }
      }
    }
  }`;
}

// Eén attachment ophalen INCL. base64 content. Voor de byte-download fase
// (carerix-attachment-download function): hier wordt de eigenlijke file
// binnengehaald en in Supabase Storage gezet.
export function crAttachmentByIdQuery(attachmentId: string): string {
  const safe = attachmentId.replace(/"/g, '\\"');
  return `query {
    crAttachment(_id: "${safe}") {
      _id
      downloadName
      displayName
      attachmentMimeType
      label
      attachmentSize
      content
    }
  }`;
}

// Per-kandidaat attachments ophalen — CRAttachment heeft geen direct
// toEmployee in deze schema; relatie via CREmployee.attachments.
export function crEmployeeAttachmentsQuery(employeeId: string, page: number, size: number): string {
  const safe = employeeId.replace(/"/g, '\\"');
  return `query {
    crEmployee(_id: "${safe}") {
      _id
      attachments(${pageable(page, size)}) {
        totalElements last
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
    }
  }`;
}

export function crTodosQuery(page: number, size: number, qualifier?: string): string {
  // Query name is `crToDoPage` (camelCase, capital D).
  // CRToDo: subject + message (NIET body), boolean is{Note/Task/Meeting/Email}
  // ipv type-veld. Parents: toEmployee/toCompany/toContact/toMatch/toJob.
  return `query {
    crToDoPage(${pageable(page, size)}${NORESTRICT}${qualifierClause(qualifier)}) {
      totalElements last
      items {
        _id
        subject
        message
        startDate
        endDate
        deadline
        creationDate
        modificationDate
        statusDisplay
        isNote
        isTask
        isMeeting
        isEmail
        toEmployee { _id }
        toCompany { _id }
        toContact { _id }
        toMatch { _id }
        toJob { _id }
      }
    }
  }`;
}

// Helper: build a `modificationDate >= '<watermark>'` qualifier voor delta-sync.
export function watermarkQualifier(modifiedSince: string | null | undefined): string | undefined {
  if (!modifiedSince) return undefined;
  const d = new Date(modifiedSince);
  if (isNaN(d.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatted =
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
  return `modificationDate >= (NSCalendarDate) '${formatted}'`;
}
