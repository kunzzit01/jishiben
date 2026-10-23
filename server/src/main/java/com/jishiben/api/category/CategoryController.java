package com.jishiben.api.category;

import com.jishiben.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/categories")
public class CategoryController {

    private final CategoryService categories;

    public CategoryController(CategoryService categories) {
        this.categories = categories;
    }

    @GetMapping
    public List<CategoryDtos.Response> list(@RequestParam(required = false) String type,
                                            @RequestParam(required = false) String groupUid,
                                            @RequestParam(defaultValue = "false") boolean includeArchived) {
        return categories.list(CurrentUser.id(), type, groupUid, includeArchived);
    }

    @GetMapping("/{clientUid}")
    public CategoryDtos.Response get(@PathVariable String clientUid) {
        return categories.get(CurrentUser.id(), clientUid);
    }

    @PutMapping
    public CategoryDtos.Response upsert(@Valid @RequestBody CategoryDtos.UpsertRequest request) {
        return categories.upsert(CurrentUser.id(), request);
    }

    @PatchMapping("/{clientUid}")
    public CategoryDtos.Response patch(@PathVariable String clientUid,
                                       @Valid @RequestBody CategoryDtos.PatchRequest request) {
        return categories.patch(CurrentUser.id(), clientUid, request);
    }

    @DeleteMapping("/{clientUid}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String clientUid) {
        categories.delete(CurrentUser.id(), clientUid);
    }
}
