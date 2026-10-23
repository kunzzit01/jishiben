package com.jishiben.api.common;

import java.util.List;
import org.springframework.data.domain.Page;

/** Bounded page envelope so list endpoints can never dump the whole table at once. */
public record PageResponse<T>(List<T> content, int page, int size, long totalElements, int totalPages) {

    public static <T> PageResponse<T> of(Page<T> page) {
        return new PageResponse<>(page.getContent(), page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages());
    }
}
