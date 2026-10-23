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
@RequestMapping("/api/category-groups")
public class CategoryGroupController {

    private final CategoryGroupService groups;

    public CategoryGroupController(CategoryGroupService groups) {
        this.groups = groups;
    }

    @GetMapping
    public List<CategoryDtos.GroupResponse> list(@RequestParam(defaultValue = "false") boolean includeArchived) {
        return groups.list(CurrentUser.id(), includeArchived);
    }

    @GetMapping("/{clientUid}")
    public CategoryDtos.GroupResponse get(@PathVariable String clientUid) {
        return groups.get(CurrentUser.id(), clientUid);
    }

    @PutMapping
    public CategoryDtos.GroupResponse upsert(@Valid @RequestBody CategoryDtos.GroupUpsertRequest request) {
        return groups.upsert(CurrentUser.id(), request);
    }

    @PatchMapping("/{clientUid}")
    public CategoryDtos.GroupResponse patch(@PathVariable String clientUid,
                                            @Valid @RequestBody CategoryDtos.GroupPatchRequest request) {
        return groups.patch(CurrentUser.id(), clientUid, request);
    }

    @DeleteMapping("/{clientUid}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String clientUid) {
        groups.delete(CurrentUser.id(), clientUid);
    }
}
